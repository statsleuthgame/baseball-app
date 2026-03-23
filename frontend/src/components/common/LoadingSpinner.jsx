export default function LoadingSpinner({ text = "Loading..." }) {
  return (
    <div className="loading-spinner" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}
