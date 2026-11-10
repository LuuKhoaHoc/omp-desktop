/* ui/icons.jsx — Icon component over the vendored Phosphor icons
   (ui/icon-paths.js, scripts/vendor-phosphor.mjs) + TOOL_META map (tool
   name → colour, icon, label). */

// Props: name, size, color. Phosphor icons are filled shapes, so `color`
// is the fill; `dotColor` and `strokeWidth` (the old stroked pack's) are
// accepted and dropped, so no caller has to change.
// `size` is in px at the default font size; the svg is sized in rem through
// `.ui-icon` (styles.css), so icons grow with the font-size tweak like the
// text beside them. A more specific rule (`.collapse-toggle svg`) still wins.
const Icon = ({ name, size = 14, color = "currentColor", dotColor, strokeWidth, style, ...rest }) => {
  const markup = window.OMP_ICON_PATHS[name];
  if (!markup) return null;
  return (
    <svg className="ui-icon" style={{ "--icon-size": `${size / 16}rem`, ...style }} viewBox="0 0 256 256"
      fill={color} {...rest}>
      <g dangerouslySetInnerHTML={{ __html: markup }} />
    </svg>
  );
};

// Tool name → color + icon
const TOOL_META = {
  read:    { color: "var(--cyan)",    icon: "file",   label: "read" },
  search:  { color: "var(--lilac)",   icon: "search", label: "find" },
  edit:    { color: "var(--accent)",  icon: "diff",   label: "edit" },
  bash:    { color: "var(--amber)",   icon: "bash",   label: "bash" },
  write:   { color: "var(--magenta)", icon: "edit",   label: "write" },
  todo:    { color: "var(--lime)",    icon: "plan",  label: "todo"  },
  eval:    { color: "var(--rose)",    icon: "test",  label: "eval"  },
  task:    { color: "var(--cyan)",    icon: "agent", label: "task"  },
  debug:   { color: "var(--amber)",   icon: "bolt",  label: "debug" },
  ask:     { color: "var(--fg-3)",    icon: "circle",label: "ask"   },
  job:     { color: "var(--cyan)",    icon: "refresh",label: "job"  }, // chat-view.jsx JobRow
  retry:   { color: "var(--amber)",   icon: "refresh",label: "retry" }, // chat/retry-row.jsx
  goal:    { color: "var(--lilac)",   icon: "goal",   label: "goal"  }, // chat/goal-row.jsx, design/goal-strip.jsx
  approval:{ color: "var(--lime)",    icon: "check",  label: "auto-approved" }, // chat/approval-row.jsx
};

Object.assign(window, { Icon, TOOL_META });
