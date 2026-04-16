import * as admin from 'firebase-admin';

// ADC(Application Default Credentials)를 사용해 초기화
admin.initializeApp({
  projectId: 'vehicle-drive-log',
});

const db = admin.firestore();

async function cleanDuplicateCalendarEvents() {
  console.log('중복 캘린더 이벤트 정리 시작...');

  // syncSource가 calendar인 모든 예약 조회
  const snapshot = await db.collection('reservations')
    .where('syncSource', '==', 'calendar')
    .get();

  if (snapshot.empty) {
    console.log('캘린더로 연동된 예약 데이터가 없습니다.');
    return;
  }

  // calendarEventId 기준으로 예약 문서를 매칭
  const eventsByCalendarId: Record<string, admin.firestore.QueryDocumentSnapshot[]> = {};
  
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const eventId = data.calendarEventId;
    if (eventId) {
      if (!eventsByCalendarId[eventId]) {
        eventsByCalendarId[eventId] = [];
      }
      eventsByCalendarId[eventId].push(doc);
    }
  });

  let duplicateCount = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const [eventId, docs] of Object.entries(eventsByCalendarId)) {
    // 2개 이상이면 중복 (중복 발생 건수)
    if (docs.length > 1) {
      // createdAt 기준으로 오름차순(오래된 순) 정렬 (없을 시 문자열 처리)
      docs.sort((a, b) => {
        const timeA = a.data().createdAt?.toMillis() || 0;
        const timeB = b.data().createdAt?.toMillis() || 0;
        return timeA - timeB;
      });

      // 가장 최근에 생성된(마지막) 1건만 남기고, 이전 것들을 삭제 대상에 추가
      // (혹은 전부 지워도 무방하지만, 최소 1건의 예약 상태는 유지하기 위함)
      const toDelete = docs.slice(0, docs.length - 1);
      
      console.log(`[Event ID: ${eventId}] 총 ${docs.length}건 중 ${toDelete.length}건 삭제 예정...`);

      for (const doc of toDelete) {
        batch.delete(doc.ref);
        duplicateCount++;
        batchCount++;

        // Batch 한도는 500
        if (batchCount === 500) {
          await batch.commit();
          console.log('--- Batch (500) 커밋 완료 ---');
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`--- 마지막 Batch (${batchCount}) 커밋 완료 ---`);
  }

  console.log(`중복 캘린더 이벤트 정리 완료. 총 ${duplicateCount}건 삭제됨.`);
}

cleanDuplicateCalendarEvents().catch(console.error);
