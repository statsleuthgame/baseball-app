export default function ErrorMessage({ message = "Something went wrong.", onRetry }) {
  return (
    <div className="error-message" role="alert" aria-live="assertive">
      <p>{message}</p>
      {onRetry && (
        <button className="btn-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
