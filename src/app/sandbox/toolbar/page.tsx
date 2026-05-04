import Link from 'next/link';

const VARIANTS = [
  {
    href: '/sandbox/toolbar/pro-editor',
    title: 'Pro Editor',
    subtitle: 'Photoshop-style',
    desc: 'Narrow icon rail on the left, contextual options bar on top, three right-side panels (library / layers / properties). Keyboard-driven, dense, dark chrome.',
    pros: ['Maximum efficiency once you know shortcuts', 'Properties panel always available', 'Closest to a real CAD/photo editor'],
    cons: ['Steeper learning curve', 'More chrome → less map area'],
  },
  {
    href: '/sandbox/toolbar/top-ribbon',
    title: 'Top Ribbon',
    subtitle: 'SketchUp-style',
    desc: 'Wide horizontal ribbon at the top with chunky labeled buttons grouped into Edit / Actions / Stamp / Layers / Active Species. Subbar shows active-tool options.',
    pros: ['Every action is a labeled visible button', 'No shortcuts required', 'Map gets full horizontal width'],
    cons: ['Eats ~140px of vertical space', 'Discoverable but slower at scale'],
  },
];

export default function SandboxToolbarIndex() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-stone-500 hover:text-primary">← home</Link>
        <h1 className="text-3xl font-bold mt-2">Toolbar UX prototypes</h1>
        <p className="text-stone-600 mt-2">
          Two interactive mockups of editor-style toolbars for the planting canvas. Each is wired
          to the same dummy plant set (≈80 plants across matrix / structure / scatter / filler
          layers) so you can compare them on identical data. None of these touch your real plans —
          they're throwaway sandboxes for evaluating UX before integration.
        </p>
        <p className="text-stone-700 mt-3 text-sm">
          <strong>Both prototypes implement the same model:</strong> shift-click to add to selection,
          alt-click to subtract, marquee + lasso, layer visibility / lock, copy/paste with relative
          offsets, brush + stamp (1/3/5/9), separate Drag-edit tool (won't move plants from the
          Move/Select cursor), keyboard shortcuts (V M L D B S E I, ⌘A, ⌘C/V, ⌫, esc).
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {VARIANTS.map(v => (
          <Link key={v.href} href={v.href}
            className="block p-5 bg-white border border-stone-200 rounded-xl hover:border-primary hover:shadow-lg transition-all">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-xl font-semibold">{v.title}</h2>
              <span className="text-xs uppercase tracking-wider text-stone-500">{v.subtitle}</span>
            </div>
            <p className="text-sm text-stone-700 mb-4">{v.desc}</p>
            <div className="text-xs space-y-1">
              {v.pros.map(p => <div key={p}><span className="text-emerald-600 font-bold">+</span> <span className="text-stone-700">{p}</span></div>)}
              {v.cons.map(c => <div key={c}><span className="text-amber-600 font-bold">−</span> <span className="text-stone-600">{c}</span></div>)}
            </div>
            <div className="mt-4 text-xs text-primary font-medium">Open prototype →</div>
          </Link>
        ))}
      </div>

      <div className="mt-8 p-4 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700">
        <p className="font-semibold mb-2">Try in each prototype:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li><strong>Selection:</strong> click a plant, shift-click another to add, alt-click to remove. Press <kbd className="px-1 bg-stone-200 rounded">M</kbd> and drag a marquee, or <kbd className="px-1 bg-stone-200 rounded">L</kbd> and lasso a region.</li>
          <li><strong>Drag-edit:</strong> select plants, press <kbd className="px-1 bg-stone-200 rounded">D</kbd>, then click+drag any selected plant to move the whole group.</li>
          <li><strong>Brush + stamp:</strong> press <kbd className="px-1 bg-stone-200 rounded">B</kbd>, hover to see the cursor preview, click to drop. Press <kbd className="px-1 bg-stone-200 rounded">S</kbd> + a 3/5/9 stamp pattern to drop a cluster per click.</li>
          <li><strong>Eyedropper:</strong> press <kbd className="px-1 bg-stone-200 rounded">I</kbd>, click an existing plant to copy its species into the active brush.</li>
          <li><strong>Layers:</strong> hide the matrix layer to focus on structural drifts, or lock the structure layer to protect it from accidental edits.</li>
          <li><strong>Copy/paste:</strong> select a region, <kbd className="px-1 bg-stone-200 rounded">⌘C</kbd>, then <kbd className="px-1 bg-stone-200 rounded">⌘V</kbd> to drop a copy at the canvas center (offsets preserved).</li>
        </ul>
      </div>
    </div>
  );
}
