import { getTestsConfig } from './tests-utils';
import * as SourceMap from 'source-map-support';

SourceMap.install();

// Try to get test configuration object, no need to do anything beside that
getTestsConfig();
