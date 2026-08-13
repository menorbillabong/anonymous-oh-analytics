'use client';
export function TrackerSection({title,children}:{title:string,children:any}){return <section className="tracker-section"><div className="tracker-section-head"><strong>{title}</strong></div><div className="tracker-section-body">{children}</div></section>}
