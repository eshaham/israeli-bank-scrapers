import { GENERAL_ERROR } from '../constants';

function createGeneralError() {
  return {
    success: false,
    errorType: GENERAL_ERROR,
  };
}

export default createGeneralError;
