#!/usr/bin/env node

/**
 * Script to validate tsconfig.json files in the monorepo
 * Ensures all tsconfig files use compatible settings with TypeScript 5.3.3+
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// Valid moduleResolution options for TypeScript 5.0+
const validModuleResolutions = ['node', 'classic', 'node12', 'nodenext', 'node16', 'bundler'];

// Minimum TypeScript version required
const minTypeScriptVersion = '5.0.0';

function findTsConfigFiles(dir) {
  const results = [];
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Skip node_modules
      if (file === 'node_modules' || file === '.git' || file === 'dist') {
        continue;
      }
      results.push(...findTsConfigFiles(fullPath));
    } else if (file === 'tsconfig.json' || file.match(/^tsconfig\..*\.json$/)) {
      results.push(fullPath);
    }
  }
  
  return results;
}

function validateTsConfig(filePath) {
  const errors = [];
  const warnings = [];
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    
    // Check moduleResolution
    const moduleResolution = config.compilerOptions?.moduleResolution;
    if (moduleResolution && !validModuleResolutions.includes(moduleResolution)) {
      errors.push(`Invalid moduleResolution: "${moduleResolution}". Valid options: ${validModuleResolutions.join(', ')}`);
    }
    
    // Check for bundler without TypeScript 5.0+
    if (moduleResolution === 'bundler') {
      warnings.push(`moduleResolution: "bundler" requires TypeScript ${minTypeScriptVersion}+`);
    }
    
    // Check for required fields (skip for base configs that only extend)
    if (!config.compilerOptions && !config.extends) {
      warnings.push('Missing compilerOptions');
    }
    
    // Check for extends that might cause issues
    if (config.extends) {
      const extendedPath = path.resolve(path.dirname(filePath), config.extends);
      if (!fs.existsSync(extendedPath + '.json') && !fs.existsSync(extendedPath)) {
        warnings.push(`Extended config not found: ${config.extends}`);
      }
    }
    
    // Check include/exclude (skip for base configs that only extend)
    if (!config.include && !config.files && !config.extends) {
      warnings.push('No include pattern or files specified');
    }
    
    return { errors, warnings, filePath };
  } catch (error) {
    return { 
      errors: [`Failed to parse ${filePath}: ${error.message}`], 
      warnings: [], 
      filePath 
    };
  }
}

function main() {
  console.log('🔍 Validating tsconfig files...\n');
  
  const tsConfigFiles = findTsConfigFiles(projectRoot);
  let hasErrors = false;
  let hasWarnings = false;
  
  for (const filePath of tsConfigFiles) {
    const relativePath = path.relative(projectRoot, filePath);
    const { errors, warnings } = validateTsConfig(filePath);
    
    if (errors.length > 0) {
      hasErrors = true;
      console.log(`❌ ${relativePath}`);
      for (const error of errors) {
        console.log(`   Error: ${error}`);
      }
    }
    
    if (warnings.length > 0) {
      hasWarnings = true;
      console.log(`⚠️  ${relativePath}`);
      for (const warning of warnings) {
        console.log(`   Warning: ${warning}`);
      }
    }
  }
  
  if (tsConfigFiles.length === 0) {
    console.log('ℹ️  No tsconfig files found');
  }
  
  console.log('\n' + '='.repeat(50));
  
  if (hasErrors) {
    console.log('❌ Validation FAILED - tsconfig errors found');
    console.log(`\n💡 Fix the errors above and ensure all tsconfig files use TypeScript ${minTypeScriptVersion}+ compatible settings.`);
    process.exit(1);
  } else if (hasWarnings) {
    console.log('⚠️  Validation PASSED with warnings');
    process.exit(0);
  } else {
    console.log('✅ All tsconfig files are valid!');
    process.exit(0);
  }
}

main();
