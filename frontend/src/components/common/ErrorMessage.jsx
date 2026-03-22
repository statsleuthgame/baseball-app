export default function ErrorMessage({ message = "Something went wrong.", onRetry }) {
  return (
    <div className="error-message">
      <p>{message}</p>
      {onRetry && (
        <button className="btn-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
