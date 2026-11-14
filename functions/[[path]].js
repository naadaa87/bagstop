// 고객 웹 페이지 진입점: 언어별 주소와 검색엔진용 정보를 붙여 응답합니다. 실제 코드는 /lib/pages.js
import { handlePage } from '../lib/pages.js';

export const onRequest = (context) => handlePage(context);
