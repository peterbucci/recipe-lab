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
          <strong className="rating-summary__label">Not yet rated</strong>
          <small className="rating-summary__count">Ratings will appear here.</small>
        </span>
      </div>
    );
  }

  const formattedAverage = average.toFixed(1);
  const label = `${formattedAverage} out of 5 from ${count} ${count === 1 ? "rating" : "ratings"}`;
  return (
    <div className="rating-summary" aria-label={label}>
      <span className="rating-summary__score">{formattedAverage}</span>
      <span className="rating-summary__details">
        <strong className="rating-summary__label">out of 5</strong>
        <small className="rating-summary__count">
          {count} {count === 1 ? "rating" : "ratings"}
        </small>
      </span>
    </div>
  );
}
