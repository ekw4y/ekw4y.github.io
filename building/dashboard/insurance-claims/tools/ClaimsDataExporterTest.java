import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Dependency-free parser, validation and JSON serialization checks. */
public class ClaimsDataExporterTest {
    static ClaimsDataExporter.Csv csv(String text) throws Exception {
        return new ClaimsDataExporter.Csv(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }
    static void check(boolean condition) { if (!condition) throw new AssertionError("Check failed"); }
    static void rejected(String text) throws Exception {
        try (var c = csv(text)) { while (c.next() != null) {} }
        catch (IOException expected) { return; }
        throw new AssertionError("Invalid CSV accepted");
    }
    public static void main(String[] args) throws Exception {
        try (var c = csv("\uFEFF\"name\",value\r\n\"A, \"\"quoted\"\"\nname\",12\r\n")) {
            c.require(List.of("name", "value"));
            var row = c.next();
            check(row.get("name").equals("A, \"quoted\"\nname"));
            check(row.get("value").equals("12")); check(c.next() == null);
            try { c.require(List.of("missing")); throw new AssertionError(); } catch (IOException expected) {}
        }
        rejected("a,b\n1\n"); rejected("a,b\n\"unclosed,b");
        rejected("a,a\n1,2\n"); rejected("a,b\n\"x\"extra,y\n");
        check(ClaimsDataExporter.cents("585.98") == 58598);
        try { ClaimsDataExporter.numeric("NaN"); throw new AssertionError(); } catch (IllegalArgumentException expected) {}
        StringWriter out = new StringWriter();
        ClaimsDataExporter.json(List.of("\"\\\n<", 42), out);
        check(out.toString().equals("[\"\\\"\\\\\\n\\u003c\",42]"));
        System.out.println("PASS: BOM, quoted commas/quotes/newlines, CRLF, invalid CSV, required columns, exact cents, finite numbers, and JSON escaping.");
    }
}
