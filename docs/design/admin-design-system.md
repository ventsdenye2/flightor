# Editorial admin design system

Reference: `admin-review-concept.png`, generated with the built-in image tool.
The generated reference is a visual specification, not production content.

- Main background: pure white `#ffffff`; sidebar/table header: `#f6f8fa`.
- Text: navy `#172b3a`; secondary: `#697784`; borders: `#dde4e8`.
- Teal accent: `#087f83`; selected row/sidebar: `#eaf5f5`; stale: orange.
- Sans-serif typography: system/Inter-like stack, headings 28–34px, body and
  controls 14–16px, metadata 12–14px, line height 1.5. No marketing eyebrows.
- Shell: fixed 220px sidebar, flexible main table/editor, 350px preview rail.
  At small laptop widths the preview moves below content; below 720px navigation
  becomes horizontal and table keeps an accessible horizontal scroll container.
- Navigation: Dashboard, Review queue, Published, Discovery monitor. Brand is
  text. Four simple outlined icons, 20px and 1.7px stroke. Account footer.
- Components: thin dividers, open tables, understated status labels, 6px button
  corners, no decorative card grid. Teal primary and outlined secondary actions.
- Editor: same shell, labeled fields, source verification, immutable version
  history, live template preview. Login: centered form in the same palette.
- All counts, rows, preview content, and workflow states come from the API.
  Empty/error/loading states replace the example rows in an empty environment.
- Publish requires explicit human attestation; save, regenerate, and reverify
  never silently publish. UI keeps unsaved edits after conflicts/errors.

## Rendered fidelity check
- Desktop preserves sidebar / table / source-inspector hierarchy.
- White/gray surfaces, navy type and teal selection match the reference.
- Outline actions and restrained status labels preserve its visual weight.
- Functional editor and source verification extend the reference workflow.
- Mobile changes navigation to horizontal scrolling and contains table overflow; viewport 390px had no page-level horizontal overflow.
