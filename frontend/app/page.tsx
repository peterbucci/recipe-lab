const mvpCapabilities = [
  "Browse a curated recipe catalog",
  "View structured ingredients and instructions",
  "Fork a recipe into a new variant",
  "Compare a variant with its parent",
  "Save, rate, and explore variant lineage",
];

export default function HomePage() {
  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Recipe Lab</p>
        <h1 id="page-title">Recipes evolve. Keep the useful history.</h1>
        <p className="lede">
          A structured recipe workspace for creating variants, understanding exactly what
          changed, and eventually learning what each cook prefers.
        </p>
        <span className="status">Foundation in progress</span>
      </section>

      <section className="panel" aria-labelledby="mvp-heading">
        <div>
          <p className="eyebrow">First milestone</p>
          <h2 id="mvp-heading">Prove recipe versioning before adding ML</h2>
        </div>
        <ol>
          {mvpCapabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ol>
      </section>

      <section className="proof" aria-label="MVP proof point">
        <p>
          <strong>The proof point:</strong> fork a carrot cake, reduce 180 g sugar to 140 g,
          swap walnuts for pecans, and retain a clear diff and parent relationship.
        </p>
      </section>
    </main>
  );
}
