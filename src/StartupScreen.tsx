import { useEffect, useState } from 'react';
import App from './App';

// A welcome animation only: it never connects to Google or uses an API key.
export default function StartupScreen() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 5_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (ready) return <App />;

  return (
    <main className="startup-backdrop">
      <section className="startup-window" role="dialog" aria-modal="true" aria-labelledby="startup-title" aria-describedby="startup-description">
        <div className="startup-titlebar">
          <span className="startup-brand">banana<span>studio</span></span>
          <span className="startup-badge">WELCOME</span>
        </div>
        <div className="startup-workbench" aria-hidden="true">
          <div className="startup-grid" />
          <span className="startup-spark startup-spark-one">✦</span>
          <span className="startup-spark startup-spark-two">✦</span>
          <div className="startup-paper"><i /><i /><i /><span>✓</span></div>
          <div className="startup-character">
            <img src="/loading-character.png" alt="" width="256" height="256" />
          </div>
          <div className="startup-shadow" />
          <div className="startup-pencil" />
        </div>
        <div className="startup-message" role="status">
          <h1 id="startup-title" aria-label="Loading…">Loading<span className="startup-dots" aria-hidden="true"><i /><i /><i /></span></h1>
          <p id="startup-description">もうすぐ、創作の時間です。</p>
          <span className="startup-caption">5秒後に編集画面が開きます</span>
        </div>
        <div className="startup-track" aria-hidden="true"><span /></div>
      </section>
    </main>
  );
}
