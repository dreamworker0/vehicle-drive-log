/**
 * SEOHead — 페이지별 SEO 메타 태그 설정
 *
 * title, description, canonical, OG 태그를 컴포넌트 안에서 그대로 렌더링한다 — React 19가
 * `<title>`·`<meta>`·`<link>`를 문서 head로 끌어올리고 페이지를 벗어나면 걷어 낸다.
 * (예전에는 react-helmet-async를 썼지만 3.x도 React 19에서는 같은 기본 기능에 맡기고 있어
 *  패키지와 Provider를 걷어냈다 — 2026-11-25)
 * 선택적으로 JSON-LD 구조화 데이터를 주입할 수 있다(본문에 남는다 — 검색엔진은 위치를 가리지 않는다).
 */

const BASE_URL = 'https://drivelog.socialprism.co.kr';
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
    <>
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
    </>
  );
}
