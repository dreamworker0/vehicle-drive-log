/**
 * ReleaseNoteItems — 업데이트 소식 한 날짜의 항목 목록 (모달·공개 페이지 공용)
 *
 * 같은 날짜 안에서 주제(area)별 소제목 아래로 모으고, 본문의 `**강조**`를 굵게 보인다.
 * 예전에는 두 화면이 같은 목록을 따로 그렸고, 항목이 배포 순서대로만 쌓였으며 별표가 그대로 보였다.
 */
import { groupByArea, splitEmphasis, type ReleaseItem } from '../../lib/releaseNotes';

const TYPE_CONFIG: Record<ReleaseItem['type'], { emoji: string; label: string; color: string }> = {
    new: { emoji: '✨', label: '신규', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    improved: { emoji: '💡', label: '개선', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    fixed: { emoji: '🐛', label: '수정', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
};

function ItemText({ text }: { text: string }) {
    return (
        // min-w-0 + anywhere: 긴 주소(https://…)가 좁은 화면에서 카드 밖으로 넘치지 않게
        <span className="min-w-0 [overflow-wrap:anywhere]">
            {splitEmphasis(text).map((part, i) => (part.strong
                ? <strong key={i} className="font-semibold text-surface-800 dark:text-surface-200">{part.text}</strong>
                : <span key={i}>{part.text}</span>))}
        </span>
    );
}

export default function ReleaseNoteItems({ items }: { items: readonly ReleaseItem[] }) {
    const groups = groupByArea(items);
    return (
        <div className="space-y-4">
            {groups.map((group, groupIdx) => (
                <div key={group.area ?? `_${groupIdx}`}>
                    {group.area && (
                        <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200 mb-2 pb-1 border-b border-surface-100 dark:border-surface-700">
                            {group.area} <span className="font-normal text-surface-400 dark:text-surface-500">· {group.items.length}</span>
                        </h4>
                    )}
                    <ul className="space-y-2 pl-1">
                        {group.items.map((item, idx) => {
                            const cfg = TYPE_CONFIG[item.type];
                            return (
                                <li key={idx} className="flex items-start gap-2.5 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap mt-0.5 ${cfg.color}`}>
                                        {cfg.emoji} {cfg.label}
                                    </span>
                                    <ItemText text={item.text} />
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
