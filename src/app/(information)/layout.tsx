import Link from "next/link";
import styles from "./information.module.css";

export default function InformationLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.page}>
    <header className={styles.header}><Link href="/about" className={styles.brand}>Sticky</Link><Link href="/">Open workspace</Link></header>
    <main className={styles.content}>{children}</main>
    <footer className={styles.footer}><nav aria-label="About Sticky"><Link href="/about">About</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav><span>sticky.yuvrajkashyap.com</span></footer>
  </div>;
}
