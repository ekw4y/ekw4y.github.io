import java.io.*;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Streams the insurance project's CSV exports into the dashboard's JSON cube.
 * Requires JDK 17+, no Maven, database, or third-party libraries.
 * Run: java ClaimsDataExporter.java /path/to/insurance-project /path/to/claims-data.json
 */
public class ClaimsDataExporter {
    static final List<String> DIMENSIONS = List.of(
        "state", "coverage", "vehicle_class", "income_band", "policy_type",
        "vehicle_size", "risk_score", "location", "claim_severity", "complaint_risk",
        "employment_status", "marital_status", "sales_channel");
    static final List<String> MEASURES = List.of("records", "actual_claim_cents",
        "predicted_claim_dollars", "monthly_premium_dollars", "lifetime_value_cents",
        "income_dollars", "records_with_income");
    static final Map<String, List<String>> ORDER = Map.of(
        "coverage", List.of("Basic", "Extended", "Premium"),
        "income_band", List.of("Low", "Lower-Middle", "Upper-Middle", "High", "Unknown"),
        "vehicle_size", List.of("Small", "Medsize", "Large"),
        "claim_severity", List.of("Low", "Medium", "High"),
        "complaint_risk", List.of("None", "Low", "High"),
        "risk_score", List.of("0", "1", "2", "3", "4", "5", "6", "7"));

    static final class Stats {
        long count, actualCents, lifetimeCents, incomeCount;
        double predicted, premium, income;
        void add(Map<String, String> row) {
            count++;
            actualCents = Math.addExact(actualCents, cents(row.get("total_claim_amount")));
            lifetimeCents = Math.addExact(lifetimeCents, cents(row.get("customer_lifetime_value")));
            predicted += numeric(row.get("predicted_claim_amount"));
            premium += numeric(row.get("monthly_premium_auto"));
            if (!row.get("income").isBlank()) { income += numeric(row.get("income")); incomeCount++; }
        }
        List<Object> measures() {
            return List.of(count, actualCents, rounded(predicted, 6), rounded(premium, 2),
                lifetimeCents, rounded(income, 2), incomeCount);
        }
    }

    static double numeric(String value) {
        double result = Double.parseDouble(value);
        if (!Double.isFinite(result)) throw new IllegalArgumentException("Non-finite numeric value");
        return result;
    }
    static long cents(String value) {
        return new BigDecimal(value).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
    static BigDecimal rounded(double value, int places) {
        if (!Double.isFinite(value)) throw new IllegalArgumentException("Non-finite total");
        return BigDecimal.valueOf(value).setScale(places, RoundingMode.HALF_UP).stripTrailingZeros();
    }

    /** CSV reader handles BOMs, escaped quotes, embedded newlines and CRLF. */
    static final class Csv implements AutoCloseable {
        final PushbackReader input;
        final List<String> header;
        long record = 1;
        Csv(InputStream stream) throws IOException {
            input = new PushbackReader(new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8)), 1);
            int firstCharacter = input.read();
            if (firstCharacter != 0xFEFF && firstCharacter != -1) input.unread(firstCharacter);
            List<String> first = fields();
            if (first == null || first.isEmpty()) throw new IOException("CSV is empty");
            first.set(0, first.get(0).replaceFirst("^\\uFEFF", ""));
            header = List.copyOf(first);
            if (new HashSet<>(header).size() != header.size()) throw new IOException("Duplicate CSV headers");
        }
        void require(Collection<String> columns) throws IOException {
            for (String column : columns) if (!header.contains(column))
                throw new IOException("Missing CSV column: " + column);
        }
        Map<String, String> next() throws IOException {
            List<String> values;
            do { values = fields(); } while (values != null && values.size() == 1 && values.get(0).isBlank());
            if (values == null) return null;
            record++;
            if (values.size() != header.size()) throw new IOException("Wrong column count at CSV record " + record);
            Map<String, String> row = new HashMap<>();
            for (int i = 0; i < header.size(); i++) row.put(header.get(i), values.get(i));
            return row;
        }
        List<String> fields() throws IOException {
            List<String> result = new ArrayList<>();
            StringBuilder field = new StringBuilder();
            boolean quoted = false, closed = false, any = false;
            int c;
            while ((c = input.read()) != -1) {
                any = true;
                if (quoted) {
                    if (c == '"') {
                        int next = input.read();
                        if (next == '"') field.append('"');
                        else { quoted = false; closed = true; if (next != -1) input.unread(next); }
                    } else field.append((char)c);
                } else if (c == ',' || c == '\n' || c == '\r') {
                    result.add(field.toString()); field.setLength(0); closed = false;
                    if (c != ',') {
                        if (c == '\r') { int next = input.read(); if (next != '\n' && next != -1) input.unread(next); }
                        return result;
                    }
                } else if (c == '"' && field.isEmpty() && !closed) quoted = true;
                else if (closed || c == '"') throw new IOException("Invalid CSV quoting near record " + record);
                else field.append((char)c);
            }
            if (quoted) throw new IOException("Unclosed CSV quote near record " + record);
            if (!any && result.isEmpty() && field.isEmpty()) return null;
            result.add(field.toString());
            return result;
        }
        public void close() throws IOException { input.close(); }
    }

    static Map<String, Object> build(Path project) throws IOException {
        Path directory = project.resolve("dashboard/dashboard-data");
        Map<List<String>, Stats> groups = new HashMap<>();
        List<SortedSet<String>> categories = new ArrayList<>();
        for (String ignored : DIMENSIONS) categories.add(new TreeSet<>());
        long count = 0, actualCents = 0;
        double prediction = 0;
        try (ZipFile zip = new ZipFile(directory.resolve("claims-predictions.zip").toFile())) {
            List<? extends ZipEntry> csvs = zip.stream().filter(e -> !e.isDirectory() && e.getName().endsWith(".csv")).toList();
            if (csvs.size() != 1) throw new IOException("Expected exactly one predictions CSV in the ZIP");
            try (Csv csv = new Csv(zip.getInputStream(csvs.get(0)))) {
                csv.require(DIMENSIONS);
                csv.require(List.of("total_claim_amount", "predicted_claim_amount", "monthly_premium_auto", "customer_lifetime_value", "income"));
                Map<String, String> row;
                while ((row = csv.next()) != null) {
                    List<String> key = new ArrayList<>();
                    for (int i = 0; i < DIMENSIONS.size(); i++) {
                        String value = row.get(DIMENSIONS.get(i)).strip();
                        if (value.isEmpty()) value = "Unknown";
                        categories.get(i).add(value); key.add(value);
                    }
                    groups.computeIfAbsent(List.copyOf(key), ignored -> new Stats()).add(row);
                    count++; actualCents = Math.addExact(actualCents, cents(row.get("total_claim_amount")));
                    prediction += numeric(row.get("predicted_claim_amount"));
                }
            }
        }
        if (count == 0) throw new IOException("Predictions CSV has no data rows");
        List<List<String>> values = new ArrayList<>();
        List<Map<String, Integer>> indexes = new ArrayList<>();
        for (int i = 0; i < DIMENSIONS.size(); i++) {
            List<String> names = new ArrayList<>();
            for (String v : ORDER.getOrDefault(DIMENSIONS.get(i), List.of())) if (categories.get(i).contains(v)) names.add(v);
            for (String v : categories.get(i)) if (!names.contains(v)) names.add(v);
            values.add(names);
            Map<String, Integer> lookup = new HashMap<>();
            for (int j = 0; j < names.size(); j++) lookup.put(names.get(j), j);
            indexes.add(lookup);
        }
        List<List<String>> keys = new ArrayList<>(groups.keySet());
        keys.sort((a, b) -> { for (int i = 0; i < a.size(); i++) { int c = a.get(i).compareTo(b.get(i)); if (c != 0) return c; } return 0; });
        List<List<Object>> cells = new ArrayList<>();
        long verifiedCount = 0, verifiedCents = 0; double verifiedPrediction = 0;
        for (List<String> key : keys) {
            Stats s = groups.get(key);
            List<Object> cell = new ArrayList<>();
            for (int i = 0; i < key.size(); i++) cell.add(indexes.get(i).get(key.get(i)));
            cell.addAll(s.measures()); cells.add(cell);
            verifiedCount += s.count; verifiedCents += s.actualCents; verifiedPrediction += rounded(s.predicted, 6).doubleValue();
        }
        if (count != verifiedCount || actualCents != verifiedCents || Math.abs(prediction - verifiedPrediction) >= .02)
            throw new IOException("Grouped data failed reconciliation against source totals");
        List<Map<String, Object>> models = new ArrayList<>(), features = new ArrayList<>();
        try (Csv csv = new Csv(Files.newInputStream(directory.resolve("model_results.csv")))) {
            csv.require(List.of("Model", "MAE", "RMSE", "R2")); Map<String, String> row;
            while ((row = csv.next()) != null) {
                Map<String, Object> model = new LinkedHashMap<>(); model.put("name", row.get("Model"));
                for (String metric : List.of("MAE", "RMSE", "R2")) model.put(metric, numeric(row.get(metric)));
                models.add(model);
            }
        }
        try (Csv csv = new Csv(Files.newInputStream(directory.resolve("feature_importances.csv")))) {
            csv.require(List.of("Feature", "Importance")); Map<String, String> row;
            while ((row = csv.next()) != null) features.add(Map.of("name", row.get("Feature"), "importance", numeric(row.get("Importance"))));
        }
        if (models.isEmpty() || features.isEmpty()) throw new IOException("Model/feature export is empty");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", 1); result.put("generator", "ClaimsDataExporter.java (Java 17+)");
        result.put("source", "claims_predictions.csv — full synthetic portfolio");
        result.put("dimensions", DIMENSIONS); result.put("values", values); result.put("measures", MEASURES);
        result.put("recordCount", count); result.put("cells", cells); result.put("models", models); result.put("features", features);
        result.put("verification", Map.of("actualClaimCents", actualCents, "predictedClaimDollars", rounded(prediction, 6)));
        return result;
    }

    /** Minimal JSON writer for this export's maps, arrays, finite numbers and strings. */
    static void json(Object value, Writer out) throws IOException {
        if (value instanceof String s) {
            out.write('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"' -> out.write("\\\""); case '\\' -> out.write("\\\\");
                    case '\n' -> out.write("\\n"); case '\r' -> out.write("\\r"); case '\t' -> out.write("\\t");
                    default -> { if (c < 32 || c == '<' || c == '\u2028' || c == '\u2029') out.write(String.format("\\u%04x", (int)c)); else out.write(c); }
                }
            }
            out.write('"');
        } else if (value instanceof Map<?, ?> map) {
            out.write('{'); boolean first = true;
            for (var e : map.entrySet()) { if (!first) out.write(','); first = false; json(e.getKey().toString(), out); out.write(':'); json(e.getValue(), out); }
            out.write('}');
        } else if (value instanceof Iterable<?> values) {
            out.write('['); boolean first = true;
            for (Object item : values) { if (!first) out.write(','); first = false; json(item, out); }
            out.write(']');
        } else if (value instanceof Number) out.write(value.toString());
        else throw new IOException("Unsupported JSON type: " + value);
    }

    public static void main(String[] args) {
        if (args.length != 2) {
            System.err.println("Usage: java ClaimsDataExporter.java <insurance-project-directory> <output.json>");
            System.exit(2);
        }
        Path temporary = null;
        try {
            Map<String, Object> result = build(Path.of(args[0]));
            Path output = Path.of(args[1]).toAbsolutePath(); Files.createDirectories(output.getParent());
            temporary = Files.createTempFile(output.getParent(), ".claims-export-", ".tmp");
            try (Writer out = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8)) { json(result, out); out.write('\n'); }
            try { Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException e) { Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING); }
            System.out.printf("Exported %,d records in %,d groups to %s%n", result.get("recordCount"), ((List<?>)result.get("cells")).size(), output);
        } catch (Exception e) {
            if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
            System.err.println("Export failed: " + e.getMessage()); System.exit(1);
        }
    }
}
