# Favicon source

User-supplied gray cloud character on orange background, edited with the built-in imagegen tool on 2026-10-13. The top gray vertical line was removed. The square image is the source for local favicon formats. Original supplied image was left untouched.

Editing prompt:

> Edit the attached image for use as a website favicon. Preserve the exact gray cloud-shaped cute character, its two white round eyes with black pupils, its two orange curved cheek accents, its orange background, and its existing subtle shadow. Remove ONLY the thin gray vertical antenna / hanging line that rises from the very top center of the gray character to the upper edge, and replace it seamlessly with the same orange background. No gray line or stem above the character. Produce a square image, centering the complete character and adding matching orange background above and below as needed so that the wide character is not cropped or stretched. Keep a small safe padding on all sides. No text, no border, no extra objects or style changes. This is a faithful image edit, not a redesign.

`public/favicon.ico` contains 16/32/48/64px PNG frames. `public/favicon-32.png` is 32px; `public/apple-touch-icon.png` is 180px. They were resized using macOS sips and packaged into ICO with Node.js. Vite copies public assets into dist automatically. No external asset host or script is required.

`public/loading-character.png` is the same edited source resized to 384px with sips. The welcome window animates this image with local CSS; no image generation or external animation library runs during startup.
