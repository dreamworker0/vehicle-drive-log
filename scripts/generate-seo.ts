import * as fs from 'fs';
import * as path from 'path';

const DOMAIN = 'https://vehicle-drive-log.web.app';

const PAGES = [
  { path: '', changefreq: 'daily', priority: '1.0' },
  { path: '/apply', changefreq: 'weekly', priority: '0.8' },
  { path: '/terms', changefreq: 'monthly', priority: '0.5' },
  { path: '/privacy', changefreq: 'monthly', priority: '0.5' },
  { path: '/release-notes', changefreq: 'weekly', priority: '0.6' },
  { path: '/faq', changefreq: 'weekly', priority: '0.7' }
];

function generateSeoFiles() {
  const today = new Date().toISOString().split('T')[0];

  // sitemap.xml 생성
  let sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemapXml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  PAGES.forEach((page) => {
    sitemapXml += '  <url>\n';
    sitemapXml += `    <loc>${DOMAIN}${page.path}</loc>\n`;
    sitemapXml += `    <lastmod>${today}</lastmod>\n`;
    sitemapXml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    sitemapXml += `    <priority>${page.priority}</priority>\n`;
    sitemapXml += '  </url>\n';
  });

  sitemapXml += '</urlset>\n';

  // robots.txt 생성
  let robotsTxt = 'User-agent: *\n';
  robotsTxt += 'Allow: /\n';
  robotsTxt += `\nSitemap: ${DOMAIN}/sitemap.xml\n`;

  // dist 폴더 확인 및 파일 저장
  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemapXml, 'utf-8');
  fs.writeFileSync(path.join(distDir, 'robots.txt'), robotsTxt, 'utf-8');

  console.log('[SEO Pipeline] sitemap.xml and robots.txt generated successfully in dist/');
}

generateSeoFiles();
