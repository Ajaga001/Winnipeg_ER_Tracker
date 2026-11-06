// frontend/src/hooks/useFindings.js
import { useState, useEffect } from "react";
import { fetchFindings } from "../lib/api";

// Findings describe months of history, so one fetch per page view is enough.
export function useFindings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchFindings()
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}
