import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import Header from '../components/Header';

export default function Terminal() {
  const { id } = useParams();
  const containerRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const term = new XTerm({
      theme: { background: '#0b0d12' },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 14,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    // The container's size changes whenever the window resizes or the
    // surrounding layout reflows - without this, xterm keeps whatever
    // column/row count it computed at mount and the terminal box either
    // gets clipped or leaves dead space instead of filling its frame.
    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(containerRef.current);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/instances/${id}/terminal`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => setStatus('connected');
    ws.onmessage = (event) => term.write(new Uint8Array(event.data));
    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('disconnected');
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [id]);

  return (
    <div className="page terminal-page">
      <Header />
      <div className="page-content">
        <div className="terminal-toolbar">
          <Link to="/dashboard">← Back to dashboard</Link>
          <span className={`connection-status ${status}`}>
            {status === 'connecting' && 'Connecting…'}
            {status === 'connected' && 'Connected'}
            {status === 'disconnected' && 'Disconnected'}
          </span>
        </div>
        <div className="terminal-frame" ref={containerRef} />
      </div>
    </div>
  );
}
