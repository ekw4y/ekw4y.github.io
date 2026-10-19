
const toggle = document.querySelector('.theme-toggle');

if (toggle) {
	// 1. Get saved theme, or fallback to 'dark' on their first visit
	const saved = localStorage.getItem('theme') || 'dark';

	// 2. Apply it immediately to the HTML element
	document.documentElement.dataset.theme = saved;

	// 3. Set the button text based on what theme is currently active
	toggle.textContent = saved === 'dark' ? 'Light mode' : 'Dark mode';

	toggle.addEventListener('click', () => {
		// 4. Look at the active theme attribute to decide the next theme
		const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';

		// 5. Update the attribute, storage, and button text cleanly
		document.documentElement.dataset.theme = next;
		localStorage.setItem('theme', next);
		toggle.textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
	});
}

document.querySelectorAll('.gallery img').forEach((img) => {
	img.addEventListener('click', () => {
		const lb = document.querySelector('.lightbox');

		if (lb) {
			lb.querySelector('img').src = img.src;
			lb.classList.add('open');
		}
	});
});

const lb = document.querySelector('.lightbox');

if (lb) {
	lb.addEventListener('click', () => lb.classList.remove('open'));
}

document.addEventListener("DOMContentLoaded", () => {
  const containers = document.querySelectorAll('.image-container');

  containers.forEach(container => {
    const img = container.querySelector('img');
    if (img && img.getAttribute('alt')) {
      // Create the overlay element
      const overlay = document.createElement('div');
      overlay.classList.add('image-overlay');
      // Set its text to match the image's alt text
      overlay.textContent = img.getAttribute('alt');
      // Append it to the container
      container.appendChild(overlay);
    }
  });
});
