// Copies the game data file (an uncompressed ZIP) into the app's private storage.
onmessage = async (e) => {
  const file = e.data.file;
  const post = (m) => postMessage(m);
  try {
    const u32 = (dv, o) => dv.getUint32(o, true), u16 = (dv, o) => dv.getUint16(o, true);
    const tailLen = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Das ist keine gültige Spieldatei (kein ZIP).');
    const count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOff = u32(tail, eocd + 16);
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const entries = [];
    for (let i = 0, p = 0; i < count; i++) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('Spieldatei beschädigt.');
      const method = u16(cd, p + 10), size = u32(cd, p + 24), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32), lho = u32(cd, p + 42);
      const name = new TextDecoder().decode(new Uint8Array(cd.buffer, p + 46, nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      if (method !== 0) throw new Error('Spieldatei ist komprimiert – bitte die mitgelieferte Datei verwenden.');
      entries.push({name, size, lho});
    }
    if (!entries.find(x => x.name === 'STFU.ISO') || !entries.find(x => x.name.toUpperCase() === 'STTNG/STTNG.EXE'))
      throw new Error('In der Datei fehlen Spieldaten (STFU.ISO / STTNG).');
    const total = entries.reduce((a, x) => a + x.size, 0);
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('stfu', {recursive: true}); } catch (_) {}
    const g = await root.getDirectoryHandle('stfu', {create: true});
    let done = 0;
    for (const en of entries) {
      const lh = new DataView(await file.slice(en.lho, en.lho + 30).arrayBuffer());
      const start = en.lho + 30 + u16(lh, 26) + u16(lh, 28);
      const parts = (en.name === 'STFU.ISO' ? ['STFU.ISO'] : ['c', ...en.name.split('/')]);
      let d = g;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, {create: true});
      const h = await (await d.getFileHandle(parts[parts.length - 1], {create: true})).createSyncAccessHandle();
      h.truncate(0);
      const CH = 8 << 20;
      for (let o = 0; o < en.size; o += CH) {
        const buf = new Uint8Array(await file.slice(start + o, start + Math.min(en.size, o + CH)).arrayBuffer());
        h.write(buf, {at: o});
        done += buf.length;
        post({type: 'progress', done, total});
      }
      h.flush(); h.close();
    }
    const m = await (await g.getFileHandle('ready', {create: true})).createSyncAccessHandle();
    m.write(new TextEncoder().encode('1'), {at: 0}); m.flush(); m.close();
    post({type: 'done'});
  } catch (err) {
    post({type: 'error', message: err.message || String(err)});
  }
};
