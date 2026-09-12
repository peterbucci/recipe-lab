import { LoadingStatus } from "../../../../shared/ui/loading-status";
import { LoadingBlock } from "../../../../shared/ui/loading-ui";

export default function RecipeCompareLoading() {
  return (
    <main
      id="main-content"
      className="page-loading page-loading--comparison page-shell page-shell--detail recipe-comparison-page recipe-comparison-page--loading"
      aria-busy="true"
    >
      <LoadingStatus
        exitHref="/recipes"
        exitLabel="Browse recipes"
        label="Loading recipe comparison…"
      />
      <div className="page-loading__recipe recipe-comparison-loading" aria-hidden="true">
        <div className="page-loading__recipe-hero">
          <LoadingBlock className="page-loading__recipe-artwork" />
          <div className="page-loading__recipe-intro">
            <div className="recipe-comparison-loading__label-row">
              <LoadingBlock className="loading-block--pill" />
              <LoadingBlock className="loading-block--small" />
              <LoadingBlock className="loading-block--small" />
            </div>
            <LoadingBlock className="loading-block--title" />
            <LoadingBlock className="loading-block--copy" />
            <LoadingBlock className="loading-block--copy loading-block--copy-short" />
            <div className="recipe-comparison-loading__author">
              <LoadingBlock className="recipe-comparison-loading__avatar" />
              <span>
                <LoadingBlock className="loading-block--small" />
                <LoadingBlock className="loading-block--copy-short" />
              </span>
            </div>
            <div className="page-loading__facts">
              {Array.from({ length: 4 }, (_, index) => (
                <LoadingBlock key={index} />
              ))}
            </div>
            <div className="recipe-comparison-loading__strip">
              <LoadingBlock className="recipe-comparison-loading__strip-icon" />
              <span>
                <LoadingBlock className="loading-block--small" />
                <LoadingBlock className="loading-block--copy-short" />
              </span>
              <LoadingBlock className="loading-block--pill" />
            </div>
            <div className="page-loading__actions">
              {Array.from({ length: 2 }, (_, index) => (
                <LoadingBlock key={index} />
              ))}
            </div>
          </div>
        </div>
        <div className="page-loading__recipe-tabs">
          {Array.from({ length: 3 }, (_, index) => (
            <LoadingBlock key={index} />
          ))}
        </div>
        <div className="recipe-comparison-loading__legend">
          {Array.from({ length: 4 }, (_, index) => (
            <LoadingBlock className="loading-block--small" key={index} />
          ))}
        </div>
        <div className="page-loading__recipe-body page-loading__recipe-body--comparison">
          <div>
            <LoadingBlock className="loading-block--heading" />
            {Array.from({ length: 6 }, (_, index) => (
              <LoadingBlock className="loading-block--row" key={index} />
            ))}
          </div>
          <div>
            <LoadingBlock className="loading-block--heading" />
            {Array.from({ length: 5 }, (_, index) => (
              <LoadingBlock className="loading-block--row" key={index} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
