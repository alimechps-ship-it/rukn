import Link from "next/link";

export default function NotFound() {
  return (
    <section className="center-page">
      <div>
        <div className="eyebrow">404</div>
        <h1>Page not found · الصفحة غير موجودة</h1>
        <p className="lead">The page you are looking for does not exist or has moved.</p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <Link className="btn btn-teal" href="/en">Home</Link>
          <Link className="btn btn-outline" href="/ar">الرئيسية</Link>
        </div>
      </div>
    </section>
  );
}
