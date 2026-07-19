import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(
  process.cwd(),
  'docs',
  'diagrams',
  'vehicle-drive-log-organization-journey.html',
);

describe('vehicle-drive-log organization journey source', () => {
  it('두 역할의 전체 업무 흐름을 포함한다', () => {
    const html = readFileSync(sourcePath, 'utf8');
    [
      '기관관리자 관점',
      '서비스 도입 신청',
      '승인·온보딩',
      '차량·운영 설정',
      '직원 초대·배포',
      '운영 현황 관리',
      '보고·차량 개선',
      '기관직원 관점',
      '초대받고 가입',
      '앱 설치·연동',
      '차량 예약',
      '운행·일지 작성',
      '내 기록 확인',
    ].forEach((label) => expect(html).toContain(label));
  });

  it('역할 간 인계와 핵심 도구를 포함한다', () => {
    const html = readFileSync(sourcePath, 'utf8');
    [
      '직원 초대·사용 권한',
      '운행 기록·현황',
      'Google Calendar',
      'TMAP',
      'Slack',
      'PDF·Excel',
    ].forEach((label) => expect(html).toContain(label));
  });

  it('표 요소 없이 두 개의 흐름 영역을 사용한다', () => {
    const html = readFileSync(sourcePath, 'utf8');
    expect(html).not.toContain('<table');
    expect(html.match(/class="journey (admin|emp)"/g)).toHaveLength(2);
  });
});
