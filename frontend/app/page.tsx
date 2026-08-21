import Link from "next/link";

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="eyebrow">Structured recipes. Useful history.</p>
          <h1 id="home-title">A good recipe is only the beginning.</h1>
          <p className="lede">
            Browse a living catalog where every variation keeps its ingredients, method, and
            relationship to the recipe that inspired it.
          </p>
          <div className="button-row">
            <Link className="button button--primary" href="/recipes">
              Browse the catalog
            </Link>
            <Link className="button button--secondary" href="/recipes?q=carrot">
              See the carrot cake lineage
            </Link>
          </div>
        </div>

        <div className="lineage-preview" aria-label="Example recipe lineage">
          <div className="lineage-preview__card">
            <span>Original · v1</span>
            <strong>Carrot walnut cake</strong>
            <small>180 g sugar · walnuts</small>
          </div>
          <span className="lineage-preview__connector" aria-hidden="true">
            ↓
          </span>
          <div className="lineage-preview__card lineage-preview__card--accent">
            <span>Variant · v2</span>
            <strong>Lower-sugar pecan cake</strong>
            <small>140 g sugar · pecans</small>
          </div>
        </div>
      </section>

      <section className="home-principles" aria-labelledby="principles-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The MVP promise</p>
            <h2 id="principles-heading">Make recipe evolution understandable.</h2>
          </div>
          <p>
            Recipe Lab starts with durable product fundamentals. Personalization comes after the
            core cooking experience works.
          </p>
        </div>
        <div className="principle-grid">
          <article>
            <span>01</span>
            <h3>Browse every version</h3>
            <p>Originals and variants stay discoverable instead of collapsing into one latest copy.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Cook from structure</h3>
            <p>Quantities, units, preparation notes, and ordered instructions remain precise.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Follow the lineage</h3>
            <p>Move between a recipe, its parent, and its direct children without losing context.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
