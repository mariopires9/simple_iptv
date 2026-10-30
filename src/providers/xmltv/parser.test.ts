// EPG-02 AC1/AC5: streaming XMLTV parse — entities, CDATA, times, chunk boundaries.
// Synthetic feed only (no real provider data).
import { describe, expect, it } from 'vitest';
import { XmltvParser, parseXmltvTime, type XmltvChannel, type XmltvProgramme } from './parser';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<!-- generated <for> tests -->
<tv generator-info-name="test">
  <channel id="one.test">
    <display-name lang="pt">Canal Um</display-name>
    <display-name>Um &amp; Dois</display-name>
    <icon src="https://img.example.test/1.png"/>
  </channel>
  <programme start="20261030100000 +0100" stop="20261030110000 +0100" channel="one.test">
    <title lang="pt">Not&#237;cias &lt;b&gt;bold&lt;/b&gt; &#x1F4FA; &nbsp;</title>
    <title lang="en">Second title ignored</title>
    <desc><![CDATA[<script>alert(1)</script> & "quoted"]]></desc>
    <category>News</category>
  </programme>
  <programme start="20261030110000 +0100" channel="one.test"><title>Open ended</title></programme>
  <programme start="20261030113000 +0100" stop="20261030120000 +0100" channel="one.test">
    <title>Next</title>
  </programme>
  <programme start="bad" stop="20261030120000" channel="one.test"><title>Bad time</title></programme>
</tv>`;

function parse(chunks: readonly string[]) {
  const channels: XmltvChannel[] = [];
  const programmes: XmltvProgramme[] = [];
  const parser = new XmltvParser({
    channel: (c) => channels.push(c),
    programme: (p) => programmes.push(p),
  });
  for (const chunk of chunks) parser.write(chunk);
  parser.end();
  return { channels, programmes, parser };
}

describe('XmltvParser', () => {
  it('extracts channels and programmes, decoding entities and CDATA as plain text', () => {
    const { channels, programmes, parser } = parse([FEED]);
    expect(parser.sawRoot).toBe(true);
    expect(channels).toEqual([{ id: 'one.test', names: ['Canal Um', 'Um & Dois'] }]);
    expect(programmes).toHaveLength(3);
    const [first, open, next] = programmes;
    expect(first).toEqual({
      channel: 'one.test',
      start: Date.UTC(2026, 9, 30, 9),
      end: Date.UTC(2026, 9, 30, 10),
      // Markup-looking text stays text; unknown HTML entities are kept literally.
      title: 'Notícias <b>bold</b> 📺 &nbsp;',
      desc: '<script>alert(1)</script> & "quoted"',
    });
    // No `stop`: ends when the channel's next programme starts.
    expect(open).toMatchObject({ title: 'Open ended', end: Date.UTC(2026, 9, 30, 10, 30) });
    expect(next?.title).toBe('Next');
    expect(parser.stats.skipped).toBe(1);
  });

  it('gives the same result whatever the chunk boundaries', () => {
    const whole = parse([FEED]);
    const oneByOne = parse([...FEED]);
    const sevens = parse(FEED.match(/[\s\S]{1,7}/g) ?? []);
    expect(oneByOne.programmes).toEqual(whole.programmes);
    expect(oneByOne.channels).toEqual(whole.channels);
    expect(sevens.programmes).toEqual(whole.programmes);
  });

  it('does not report a non-XMLTV body as one', () => {
    const { parser, programmes } = parse(['<html><body>Not found</body></html>']);
    expect(parser.sawRoot).toBe(false);
    expect(programmes).toEqual([]);
  });
});

describe('parseXmltvTime', () => {
  it.each([
    ['20261030120000 +0000', Date.UTC(2026, 9, 30, 12)],
    ['20261030120000 -0230', Date.UTC(2026, 9, 30, 14, 30)],
    ['20261030120000', Date.UTC(2026, 9, 30, 12)],
    ['202610301200 +01:00', Date.UTC(2026, 9, 30, 11)],
    ['20261030', Date.UTC(2026, 9, 30)],
  ])('%s', (value, expected) => {
    expect(parseXmltvTime(value)).toBe(expected);
  });

  it('rejects malformed values', () => {
    expect(parseXmltvTime('2026-10-30 12:00')).toBeUndefined();
    expect(parseXmltvTime('20261340120000')).toBeUndefined();
    expect(parseXmltvTime(undefined)).toBeUndefined();
  });
});
