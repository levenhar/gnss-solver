import { useParams } from "react-router-dom";
export function JobDetail() {
  const { id } = useParams();
  return <div className="text-muted">Job {id} (detail coming).</div>;
}
