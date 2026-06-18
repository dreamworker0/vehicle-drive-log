import { RuleTester } from 'eslint'
import rule from './require-organization-filter.js'

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

ruleTester.run('require-organization-filter', rule, {
  valid: [
    // 인라인 where('organizationId', ...) — 정상
    {
      code: `async function f(orgId){
        const q = query(coll(), where('organizationId','==',orgId), where('date','==',d))
        return getDocs(q)
      }`,
    },
    // 동적 constraints 배열에 org 필터를 push — 정상 (같은 함수 본문에 존재)
    {
      code: `async function f(orgId){
        const c = []
        c.push(where('organizationId','==',orgId))
        if (date) c.push(where('date','==',date))
        const q = query(coll(), ...c)
        return getDocs(q)
      }`,
    },
    // query() 호출 자체가 없으면 검사 대상 아님
    {
      code: `async function f(){ return doSomething() }`,
    },
    // 화살표 함수 + org 필터 — 정상
    {
      code: `const f = async (orgId) => {
        const q = query(coll(), where('organizationId','==',orgId))
        return getDocs(q)
      }`,
    },
  ],
  invalid: [
    // 인라인 org 필터 누락 — 위반
    {
      code: `async function f(){
        const q = query(coll(), where('date','==',d))
        return getDocs(q)
      }`,
      errors: [{ messageId: 'missingOrgFilter' }],
    },
    // 동적 배열에 org 필터 없이 다른 조건만 push — 위반
    {
      code: `async function f(){
        const c = []
        c.push(where('date','==',d))
        const q = query(coll(), ...c)
        return getDocs(q)
      }`,
      errors: [{ messageId: 'missingOrgFilter' }],
    },
  ],
})
