/**
 * gcloud 인증된 환경에서 Firestore REST API로 집계 통계 재계산
 */
const { execSync } = require('child_process');

const PROJECT_ID = 'vehicle-drive-log';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// gcloud 액세스 토큰 가져오기
function getAccessToken() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

async function firestoreRequest(path, method = 'GET', body = null) {
    const token = getAccessToken();
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${BASE_URL}${path}`, options);
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Firestore API 오류 (${response.status}): ${errText}`);
    }
    return response.json();
}

async function runQuery(structuredQuery) {
    const token = getAccessToken();
    const url = `${BASE_URL}:runQuery`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ structuredQuery }),
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Query 오류 (${response.status}): ${errText}`);
    }
    return response.json();
}

function parseFirestoreValue(val) {
    if (!val) return null;
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return Number(val.integerValue);
    if ('doubleValue' in val) return val.doubleValue;
    if ('timestampValue' in val) return new Date(val.timestampValue);
    if ('booleanValue' in val) return val.booleanValue;
    if ('nullValue' in val) return null;
    return null;
}

function toFirestoreValue(val) {
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return { integerValue: String(val) };
        return { doubleValue: val };
    }
    if (typeof val === 'boolean') return { booleanValue: val };
    if (val === null) return { nullValue: 'NULL_VALUE' };
    if (typeof val === 'object' && !Array.isArray(val)) {
        const fields = {};
        for (const [k, v] of Object.entries(val)) {
            fields[k] = toFirestoreValue(v);
        }
        return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
}

async function main() {
    console.log('🔄 운행일지 집계 통계 재계산을 시작합니다...\n');

    // 1. 모든 기관 목록 조회
    let orgs = [];
    let pageToken = null;
    do {
        let url = '/organizations?pageSize=100';
        if (pageToken) url += `&pageToken=${pageToken}`;
        const result = await firestoreRequest(url);
        if (result.documents) {
            orgs = orgs.concat(result.documents);
        }
        pageToken = result.nextPageToken;
    } while (pageToken);

    console.log(`📋 총 ${orgs.length}개 기관 발견\n`);

    let processedCount = 0;
    let totalLogsProcessed = 0;

    for (const orgDoc of orgs) {
        // 기관 ID 추출
        const orgPath = orgDoc.name;
        const orgId = orgPath.split('/').pop();
        const orgName = orgDoc.fields?.name?.stringValue || orgId;

        // 2. 해당 기관의 운행일지 조회
        const queryResults = await runQuery({
            from: [{ collectionId: 'driveLogs' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'organizationId' },
                    op: 'EQUAL',
                    value: { stringValue: orgId },
                },
            },
            limit: 10000,
        });

        let totalCount = 0;
        let totalDistance = 0;
        const monthlyStats = {};

        for (const result of queryResults) {
            if (!result.document) continue;

            const fields = result.document.fields;
            const startKm = parseFirestoreValue(fields?.startKm) || 0;
            const endKm = parseFirestoreValue(fields?.endKm) || 0;
            const dist = Math.max(0, endKm - startKm);

            totalCount++;
            totalDistance += dist;

            // 월 키 추출
            const ts = fields?.timestamp?.timestampValue;
            if (ts) {
                const d = new Date(ts);
                const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                if (!monthlyStats[monthKey]) {
                    monthlyStats[monthKey] = { count: 0, totalDistance: 0 };
                }
                monthlyStats[monthKey].count++;
                monthlyStats[monthKey].totalDistance += dist;
            }
        }

        // 3. 통계 문서 생성/갱신 (PATCH)
        const statsFields = {
            count: toFirestoreValue(totalCount),
            totalDistance: toFirestoreValue(totalDistance),
            monthlyStats: toFirestoreValue(monthlyStats),
            lastUpdatedAt: toFirestoreValue(new Date().toISOString()),
            recalculatedAt: toFirestoreValue(new Date().toISOString()),
        };

        const token = getAccessToken();
        const patchUrl = `${BASE_URL}/organizations/${orgId}/stats/aggregate`;
        const patchResponse = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fields: statsFields }),
        });

        if (!patchResponse.ok) {
            console.error(`  ❌ [${orgName}] 통계 저장 실패: ${await patchResponse.text()}`);
        }

        processedCount++;
        totalLogsProcessed += totalCount;

        if (totalCount > 0) {
            const months = Object.keys(monthlyStats).sort();
            console.log(`  ✅ [${processedCount}/${orgs.length}] ${orgName}: ${totalCount}건, ${Math.round(totalDistance)}km (${months.join(', ')})`);
        }
    }

    console.log(`\n🎉 완료: ${processedCount}개 기관, 총 ${totalLogsProcessed}건 운행일지 집계됨`);
}

main().catch(err => {
    console.error('오류:', err.message || err);
    process.exit(1);
});
