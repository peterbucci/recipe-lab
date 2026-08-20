# ML workspace (deferred)

This directory is intentionally documentation-only during the core product MVP.

ML work begins after Recipe Lab has stable preference events, ingredient
metadata, a non-ML baseline, and an offline evaluation protocol. Planned stages:

1. Popularity or rules-based baseline.
2. Content-based recipe similarity.
3. Collaborative filtering when interaction density supports it.
4. A measured hybrid model.
5. Substitution ranking grounded in explicit ingredient relationships.

Every experiment should record its data snapshot, split strategy, metrics,
parameters, and comparison with the baseline. Model code should not block core
recipe browsing, viewing, or forking.
