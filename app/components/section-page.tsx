import type { ReactNode } from "react";

import styles from "./section-page.module.css";

type SectionPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function SectionPage({
  eyebrow,
  title,
  description,
  children,
}: SectionPageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </header>
      {children}
    </div>
  );
}
