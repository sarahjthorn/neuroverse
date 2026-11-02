// Optional link to the owner's portfolio, where a redacted snapshot of the
// brain can drift in the background (docs/PORTFOLIO.md). Set
// VITE_PORTFOLIO_URL in .env; Home hides the portfolio card when it's unset.
export const PORTFOLIO_URL = import.meta.env.VITE_PORTFOLIO_URL?.trim() || null
