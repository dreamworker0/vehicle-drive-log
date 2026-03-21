/**
 * SEOHead — 페이지별 SEO 메타 태그 설정
 *
 * react-helmet-async를 사용하여 title, description, canonical, OG 태그를 설정합니다.
 * 선택적으로 JSON-LD 구조화 데이터를 주입할 수 있습니다.
 */
import { Helmet } from 'react-helmet-async';

const BASE_URL = 'https://vehicle-drive-log.web.app';
const DEFAULT_OG_IMAGE = `${BASE_URL}/icons/icon-512.png`;
const SITE_NAME = '차량 운행일지';

interface SEOHeadProps {
  /** 페이지 제목 (예: "이용약관") — 자동으로 " - 차량 운행일지" 접미사 추가 */
  title: string;
  /** 메타 설명 */
  description: string;
  /** 경로 (예: "/terms") — canonical URL 생성에 사용 */
  path: string;
  /** 선택: JSON-LD 구조화 데이터 */
  jsonLd?: object;
  /** true이면 접미사 없이 title 그대로 사용 (랜딩 페이지용) */
  isHome?: boolean;
}

export default function SEOHead({ title, description, path, jsonLd, isHome }: SEOHeadProps) {
  const fullTitle = isHome ? title : `${title} - ${SITE_NAME}`;
  const canonicalUrl = `${BASE_URL}${path}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content="website" />
      <meta property="og:image" content={DEFAULT_OG_IMAGE} />
      <meta property="og:site_name" content={SITE_NAME} />

      {/* JSON-LD 구조화 데이터 */}
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
