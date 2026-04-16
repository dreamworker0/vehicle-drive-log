import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
// ts-node로 단독 실행 가능하도록 권한 설정이 세팅되어 있다고 가정 (또는 로컬 GOOGLE_APPLICATION_CREDENTIALS)
// 로컬 실행용으로 admin 초기화 (default)
initializeApp();

const db = getFirestore();

async function checkDuplicates() {
    console.log("=== 예약 중복 데이터(캘린더 버그) 검색 시작 ===");
    try {
        // syncSource: "calendar" 인 모든 예약 가져오기
        const snapshot = await db.collection("reservations")
            .where("syncSource", "==", "calendar")
            .get();
        
        console.log(`총 캘린더 동기화 예약 개수: ${snapshot.size}`);

        // 중복 판단 기준: vehicleId + date + startTime + endTime (동일 차량, 동일 시간)
        const counts: Record<string, string[]> = {};

        snapshot.docs.forEach((doc) => {
            const data = doc.data();
            // date가 없으면 무시
            if (!data.date || !data.vehicleId) return;

            // 키 생성
            const key = `${data.vehicleId}_${data.date}_${data.startTime || ""}_${data.endTime || ""}`;
            if (!counts[key]) {
                counts[key] = [];
            }
            counts[key].push(doc.id);
        });

        let duplicateKeyCount = 0;
        let totalDuplicateDocsToRemove = 0;

        for (const [key, docIds] of Object.entries(counts)) {
            if (docIds.length > 1) {
                duplicateKeyCount++;
                totalDuplicateDocsToRemove += (docIds.length - 1);
                // 중복 내역 일부 출력 (최대 5개까지만)
                if (duplicateKeyCount <= 5) {
                    console.log(`중복 그룹 [${key}]: 총 ${docIds.length}개 발견`);
                    console.log(` -> 보존 1개, 삭제 대상 ${docIds.length - 1}개`);
                }
            }
        }
        
        if (duplicateKeyCount > 5) {
            console.log(`...외 ${duplicateKeyCount - 5}건의 중복 그룹 존재`);
        }

        console.log("==========================================");
        console.log(`발견된 총 중복 그룹 수: ${duplicateKeyCount}`);
        console.log(`지워야 할 총 중복 문서(가짜 예약) 수: ${totalDuplicateDocsToRemove}`);
        console.log("==========================================");

    } catch (e) {
        console.error("오류 발생:", e);
    }
}

checkDuplicates();
