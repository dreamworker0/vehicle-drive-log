import { memo, useState } from 'react';
import { useFavoritePurposes } from '../../hooks/useFavoritePurposes';
import { useToast } from '../../hooks/useToast';
import { captureError } from '../../lib/sentry';
import { MAX_FAVORITE_PURPOSES } from '../../lib/firestore';

interface PurposeChipsProps {
    /** 지금 목적 칸에 적힌 값 */
    value: string;
    /** 단추를 눌렀을 때 목적 칸을 그 문구로 바꾼다 */
    onSelect: (text: string) => void;
}

/**
 * 운행 목적 칸 아래에 붙는 '자주 쓰는 목적' 단추 줄.
 *
 * 운행일지·바로 운행·예약 세 화면이 같은 모양으로 쓴다. 등록한 목적이 없고 칸도 비어 있으면
 * 아무것도 그리지 않는다 — 기존 입력 흐름("3초 컷")을 방해하지 않는다.
 * 칸에 적은 문구가 아직 목록에 없으면 바로 저장할 수 있는 작은 버튼을 보여 준다(행선지 ☆와 같은 역할).
 */
const PurposeChips = memo(function PurposeChips({ value, onSelect }: PurposeChipsProps) {
    const { purposes, has, add, isFull } = useFavoritePurposes();
    const { showToast } = useToast();
    const [saving, setSaving] = useState(false);

    const current = (value || '').trim();
    const canSave = !!current && !has(current) && !isFull;

    if (purposes.length === 0 && !canSave) return null;

    const handleSave = async () => {
        setSaving(true);
        try {
            const result = await add(current);
            if (result === 'added') showToast('자주 쓰는 목적에 저장했어요', 'success');
            else if (result === 'full') showToast(`자주 쓰는 목적은 ${MAX_FAVORITE_PURPOSES}개까지 저장할 수 있어요`, 'error');
        } catch (err) {
            captureError(err, { context: 'PurposeChips.save' });
            showToast('저장하지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="자주 쓰는 목적">
            {purposes.map(p => {
                const selected = current === p.text;
                return (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelect(p.text)}
                        aria-pressed={selected}
                        className={`px-3 py-2 min-h-[48px] rounded-full text-xs font-medium border transition-all flex items-center justify-center ${selected
                            ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                            : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                            }`}
                    >
                        {p.text}
                    </button>
                );
            })}
            {canSave && (
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-2 min-h-[48px] rounded-full text-xs font-medium border border-dashed border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300 hover:text-primary-600 dark:hover:border-primary-700 dark:hover:text-primary-300 transition-all disabled:opacity-60"
                >
                    {saving ? '저장 중…' : '+ 자주 쓰는 목적에 저장'}
                </button>
            )}
        </div>
    );
});

export default PurposeChips;
