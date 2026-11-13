/* subagents/swarm-mascot.jsx — a member's bee on a canvas (drawing:
   app/swarm-mascot.js). A bee beats its wings only while `busy`, the page is
   visible and the user has not asked for reduced motion; otherwise it is one
   still frame. Every beating bee shares ONE requestAnimationFrame loop that
   stops itself when the last one stops, so a swarm of working agents costs
   one loop, not one each. The reduced-motion preference is listened to: it
   takes effect (and ends) without a remount. */

const { OMP_SWARM_MASCOT: _SWM } = window;

const _SWM_REFRESH = 120; // frames between re-reads of the theme colours
const _SWM_reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const _SWM_beat = _SWM.createBeat(cb => requestAnimationFrame(cb), () => document.hidden, 50); // ~20 fps: a dozen working agents stay cheap
const swarmBeat = frame => _SWM_beat.join(frame);
document.addEventListener("visibilitychange", () => { if (!document.hidden) _SWM_beat.resume(); });

function swarmBeeColors(el, tone) {
  const cs = getComputedStyle(el);
  const v = name => cs.getPropertyValue(name).trim();
  const token = /^var\((--[\w-]+)\)$/.exec(tone ?? ""); // a canvas cannot resolve var()
  const body = (token ? v(token[1]) : tone) || v("--amber") || "#FFC56E";
  return { body, dark: "#1c1612", wing: "#dfe6f2", crown: "#ffd25e" };
}

function useReducedMotion() {
  const [still, setStill] = React.useState(!!_SWM_reduce?.matches);
  React.useEffect(() => {
    if (!_SWM_reduce) return undefined;
    const on = e => setStill(e.matches);
    _SWM_reduce.addEventListener("change", on);
    setStill(_SWM_reduce.matches);
    return () => _SWM_reduce.removeEventListener("change", on);
  }, []);
  return still;
}

/** `tone`: the bee's CSS colour (a member's hue); none = amber. `crown`: the coordinator. */
function SwarmMascot({ size = 40, busy = false, tone = null, crown = false }) {
  const ref = React.useRef(null);
  const still = useReducedMotion();
  React.useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let colors = swarmBeeColors(cv, tone);
    if (!busy || still) {
      _SWM.draw(g, size, 0, colors, false, crown);
      return undefined;
    }
    const phase = Math.random() * 1000; // bees in one swarm do not beat in step
    let frames = 0;
    return swarmBeat(now => {
      if (++frames % _SWM_REFRESH === 0) colors = swarmBeeColors(cv, tone);
      _SWM.draw(g, size, now + phase, colors, true, crown);
    });
  }, [size, busy, still, tone, crown]);
  return <canvas ref={ref} className="sw-bee" aria-hidden="true" />;
}

Object.assign(window, { SwarmMascot });
