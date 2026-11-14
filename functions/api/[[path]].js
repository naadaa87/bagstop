// /api/* 진입점. 실제 코드는 /lib 에 있습니다.
import { handleApi } from '../../lib/router.js';

export const onRequest = (context) => handleApi(context);
