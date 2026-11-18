// Browser agent cursor overlay — visualizes the simulated mouse position
// and click actions when the agent is interacting with the browser page.

const { React, OMP_TR } = window;

function AgentCursor({ cursor, page }) {
  if (!cursor || !page || page.cssW <= 0 || page.cssH <= 0) return null;
  const x = Math.max(0, Math.min(cursor.x, page.cssW));
  const y = Math.max(0, Math.min(cursor.y, page.cssH));
  const left = `${(x / page.cssW) * 100}%`;
  const top = `${(y / page.cssH) * 100}%`;
  const isPress = cursor.kind === "mousePressed" || cursor.kind === "down";

  return (
    <div className="agent-cursor-layer" style={{ left, top }} aria-hidden="true">
      {isPress && <span className="agent-cursor-ripple" />}
      <svg
        className="agent-cursor-pointer"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M3 3l7.5 18 2.5-6.5 6.5-2.5L3 3z"
          fill="var(--accent, #6366f1)"
          stroke="var(--bg-canvas, #1e1e1e)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="agent-cursor-badge">{OMP_TR("Agent")}</span>
    </div>
  );
}

window.AgentCursor = AgentCursor;
