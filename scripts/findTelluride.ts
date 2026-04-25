import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const saPath = resolve(__dirname, "../functions/serviceAccountKey.json");
if (existsSync(saPath)) {
    const sa = JSON.parse(readFileSync(saPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(sa) });
} else {
    initializeApp();
}

const db = getFirestore();

async function run() {
    const snapshot = await db.collection("vehicles").get();
    const targets = snapshot.docs.filter(doc => {
        const data = doc.data();
        const m = (data.modelName || "").toLowerCase();
        const d = (data.displayName || "").toLowerCase();
        return m.includes("텔루라이드") || d.includes("텔루라이드") || m.includes("델루라이드") || d.includes("델루라이드");
    });

    if (targets.length === 0) {
        console.log("텔루라이드/델루라이드 차량을 찾을 수 없습니다.");
        return;
    }

    for (const doc of targets) {
        const data = doc.data();
        const orgId = data.organizationId;
        if (!orgId) {
            console.log(`차량: ${data.displayName} -> 기관 ID 없음`);
            continue;
        }
        const orgDoc = await db.collection("organizations").doc(orgId).get();
        const orgName = orgDoc.exists ? orgDoc.data()?.name : "알 수 없는 기관";
        console.log(`차량: ${data.displayName} (모델: ${data.modelName}) -> 기관명: ${orgName} (ID: ${orgId})`);
    }
}

run().catch(console.error);
