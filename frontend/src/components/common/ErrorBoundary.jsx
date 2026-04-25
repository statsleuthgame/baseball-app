import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: "2rem", textAlign: "center", color: "#c6ccde" }}>
          <p>Something went wrong loading this page.</p>
          <button
            type="button"
            style={{ marginTop: "1rem", padding: "0.75rem 1.25rem", minHeight: 44, cursor: "pointer" }}
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
