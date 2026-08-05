import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function Terminal() {
  const { id } = useParams();
  const containerRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const term = new XTerm();
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

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
      ws.close();
      term.dispose();
    };
  }, [id]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <p>
        <Link to="/dashboard">Back to dashboard</Link>
      </p>
      {status !== 'connected' && (
        <p role="status">{status === 'connecting' ? 'Connecting...' : 'Disconnected.'}</p>
      )}
      <div ref={containerRef} style={{ height: '70vh' }} />
    </div>
  );
}
