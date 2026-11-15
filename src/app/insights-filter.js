(function () {
  function filterSources(items, labelOf, query) {
    const needle = query.trim().toLowerCase();
    const visible = needle ? items.filter(it => `${labelOf(it)} ${it.file}`.toLowerCase().includes(needle)) : items;
    return { visible, needle, showSearch: items.length > 3 };
  }

  function filterDocContent(doc, query) {
    const needle = query.trim().toLowerCase();
    const sections = (doc.sections ?? []).filter(s =>
      !needle || s.heading?.toLowerCase().includes(needle) || (s.points ?? []).some(p => p.toLowerCase().includes(needle))
    );
    const requirements = (doc.requirements ?? []).filter(r =>
      !needle || r.id?.toLowerCase().includes(needle) || r.text?.toLowerCase().includes(needle) || String(r.priority ?? "").toLowerCase().includes(needle)
    );
    return { sections, requirements, noMatch: Boolean(needle && !sections.length && !requirements.length) };
  }

  const api = { filterSources, filterDocContent };
  if (typeof window !== "undefined") window.OMP_INSIGHTS_FILTER = api;
  if (typeof module !== "undefined") module.exports = api;
})();
