/** @jest-environment node */
import { searchFromApiStream } from '../downstream';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { path: '?q=', pagePath: '?q={query}&pg={page}', headers: {} } },
  getConfig: async () => ({ SiteConfig: { SearchDownstreamMaxPage: 3 } }),
}));
jest.mock('@/lib/utils', () => ({ cleanHtmlTags: (value) => value }));

const site = { key: 'test', api: 'https://example.test/api', name: 'test' };
const item = (id, url) => ({ vod_id: id, vod_name: '测试', vod_pic: '', vod_play_url: url });
const response = (list, pagecount = 1) => ({ ok: true, json: async () => ({ list, pagecount }) });
const collect = async (stream) => { const rows = []; for await (const page of stream) rows.push(...page); return rows; };
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test('preserves signed HLS URLs and episode labels', async () => {
  global.fetch = jest.fn().mockResolvedValue(response([item(1,
    '第1集$https://media.test/a.m3u8?token=a$b&expires=123#第2集$https://media.test/b.M3U8?token=c'
  )]));
  const rows = await collect(searchFromApiStream(site, '测试'));
  expect(rows[0].episodes).toEqual(['https://media.test/a.m3u8?token=a$b&expires=123', 'https://media.test/b.M3U8?token=c']);
  expect(rows[0].episodes_titles).toEqual(['第1集', '第2集']);
});

test('rejects non-media and non-http addresses', async () => {
  global.fetch = jest.fn().mockResolvedValue(response([item(1, 'x$javascript:bad.m3u8#y$https://media.test/page.html')]));
  const rows = await collect(searchFromApiStream(site, '测试'));
  expect(rows[0].episodes).toEqual([]);
});

test('keeps first and successful later pages when one page fails', async () => {
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (url.includes('pg=2')) throw new Error('fetch failed');
    return response([item(url.includes('pg=3') ? 3 : 1, '第1集$https://media.test/a.m3u8')], 3);
  });
  const rows = await collect(searchFromApiStream(site, '测试'));
  expect(rows.map(row => row.id)).toEqual(['1', '3']);
});

test('aborts a stalled response body after headers arrive', async () => {
  global.fetch = jest.fn().mockImplementation(async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    })),
  }));
  await expect(collect(searchFromApiStream(site, '测试', true, 20))).rejects.toThrow('请求超时');
});
