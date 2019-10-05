import { GENERAL_ERROR } from '../constants';

function createGeneralError(errorMessage) {
  return {
    success: false,
    errorType: GENERAL_ERROR,
    errorMessage,
  };
}

export default createGeneralError;
