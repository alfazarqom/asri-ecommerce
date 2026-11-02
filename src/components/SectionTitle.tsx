import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
export function SectionTitle({ title, subtitle, to, action = "Lihat semua" }: { title: string; subtitle?: string; to?: string; action?: string }) {
  return <div className="section-title"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{to ? <Link to={to}>{action}<ArrowRight size={15} /></Link> : null}</div>;
}
