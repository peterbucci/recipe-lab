interface RatingSummaryProps {
  average: number | null;
  count: number;
}

export function RatingSummary({ average, count }: RatingSummaryProps) {
  if (average === null || count === 0) {
    return (
      <div className="rating-summary" aria-label="No ratings yet">
        <span className="rating-summary__score">—</span>
        <span className="rating-summary__details">
          <span className="rating-summary__stars rating-summary__stars--empty" aria-hidden="true">
            ☆☆☆☆☆
          </span>
          <small className="rating-summary__count">No ratings yet</small>
        </span>
      </div>
    );
  }

  const formattedAverage = average.toFixed(1);
  const label = `${formattedAverage} out of 5 from ${count} ${count === 1 ? "rating" : "ratings"}`;
  const starFill = `${Math.max(0, Math.min(100, (average / 5) * 100))}%`;
  return (
    <div className="rating-summary" aria-label={label}>
      <span className="rating-summary__score">{formattedAverage}</span>
      <span className="rating-summary__details">
        <span className="rating-summary__stars" aria-hidden="true">
          <span className="rating-summary__stars-base">☆☆☆☆☆</span>
          <span className="rating-summary__stars-fill" style={{ width: starFill }}>
            ★★★★★
          </span>
        </span>
        <small className="rating-summary__count">
          {count} {count === 1 ? "rating" : "ratings"}
        </small>
      </span>
    </div>
  );
}
