import { describe, it, expect } from 'vitest';
import {
    VEHICLE_MODEL_SUGGESTIONS, isElectricModel, isHydrogenModel, guessVehicleType,
} from '../../lib/vehicleModelData';

describe('vehicleModelData', () => {
    describe('isElectricModel', () => {
        it.each(['아이오닉5', 'EV3', 'EV4', 'GV60', '니로EV', '코나 일렉트릭', '테슬라 모델 Y', 'BYD 아토3', 'PV5', 'BMW iX', 'i4'])(
            '%s → 전기차', (model) => {
                expect(isElectricModel(model)).toBe(true);
            },
        );

        it.each(['레이 EV', '레이EV', '캐스퍼 일렉트릭', '무쏘 EV', '토레스 EVX', '스타리아 일렉트릭'])(
            '모델명 뒤에 EV·일렉트릭이 붙은 %s → 전기차', (model) => {
                expect(isElectricModel(model)).toBe(true);
            },
        );

        it.each(['i40', 'ix35', '투싼 ix', '아이오닉 하이브리드', '니로 HEV', '싼타페 PHEV', '쉐보레 트레일블레이저', '소나타', ''])(
            '%s → 전기차 아님', (model) => {
                expect(isElectricModel(model)).toBe(false);
            },
        );
    });

    describe('isHydrogenModel', () => {
        it('넥쏘는 수소차다', () => {
            expect(isHydrogenModel('디 올 뉴 넥쏘')).toBe(true);
            expect(isHydrogenModel('NEXO')).toBe(true);
            expect(isHydrogenModel('소나타')).toBe(false);
        });
    });

    describe('guessVehicleType', () => {
        it('경차 이름을 품은 다른 모델은 더 길게 일치한 차종을 따른다', () => {
            expect(guessVehicleType('트레일블레이저')).toBe('sedan');
            expect(guessVehicleType('그레이스')).toBe('van');
            expect(guessVehicleType('레이')).toBe('compact');
            expect(guessVehicleType('레이 EV')).toBe('compact');
        });

        it.each(['투싼', '싼타페', '팰리세이드', '스포티지', '쏘렌토', 'GV70', 'GV60', '토레스', '액티언', '그랑 콜레오스', '아르카나', 'ix35'])(
            'SUV %s → 승용', (model) => {
                expect(guessVehicleType(model)).toBe('sedan');
            },
        );

        it.each(['타스만', '무쏘 EV', '렉스턴 스포츠', '포터 EV'])('픽업·화물 %s → 트럭', (model) => {
            expect(guessVehicleType(model)).toBe('truck');
        });

        it('기존 차종 판정은 그대로다', () => {
            expect(guessVehicleType('렉스턴')).toBe('sedan');
            expect(guessVehicleType('그랜드 카니발')).toBe('van');
            expect(guessVehicleType('스타리아 일렉트릭')).toBe('van');
            expect(guessVehicleType('카운티')).toBe('bus');
            expect(guessVehicleType('모닝')).toBe('compact');
            expect(guessVehicleType('i40')).toBe('sedan');
        });

        it('모르는 모델이거나 빈 값이면 null', () => {
            expect(guessVehicleType('알 수 없는 차')).toBeNull();
            expect(guessVehicleType('  ')).toBeNull();
        });
    });

    describe('VEHICLE_MODEL_SUGGESTIONS', () => {
        it('중복된 모델명이 없다', () => {
            expect(new Set(VEHICLE_MODEL_SUGGESTIONS).size).toBe(VEHICLE_MODEL_SUGGESTIONS.length);
        });

        it('자동완성의 모든 모델이 차종을 추측할 수 있다', () => {
            const unguessed = VEHICLE_MODEL_SUGGESTIONS.filter(m => guessVehicleType(m) === null);
            expect(unguessed).toEqual([]);
        });
    });
});
