#!/usr/bin/env node

process.on('unhandledRejection', err => {throw err});

const fs = require('fs');
const chalk = require('chalk');
const dependencyCheck = require('dependency-check');
const pathModule = require('path');
const findPackageFiles = require('@brillout/find-package-files');
const assert = require('@brillout/reassert');

if( isCli() ) {
    checkDeps();
} else {
    module.exports = checkDeps;
}

async function checkDeps(monorepoRootDir=process.cwd(), dependencyCheckOpts) {
    const monorepoPackage = await getPackageJson(monorepoRootDir);
    const {workspaces} = monorepoPackage;

    let errors = [];

    const skipedWorkspaces = [];

    for(const pkgPath of workspaces) {
        const pkgRootDir = pathModule.join(monorepoRootDir, pkgPath);
        const pkg = await getPackageJson(pkgRootDir);
        if( (pkg.checkDeps||{}).skip === true ) {
            skipedWorkspaces.push(pkgPath);
            continue;
        }
        let skip = [];
        if( (pkg.checkDeps||{}).skip instanceof Array ) {
            skip = pkg.checkDeps.skip;
        }
        try {
            errors.push(...await checkPackage({pkgRootDir, dependencyCheckOpts, skip}));
        } catch(err) {
            console.error(chalk.bold.red('\nError for '+pkgRootDir+'\n'));
            throw err;
            process.exit();
        }
    }

    if( errors.length===0 ) {
        console.log('All dependencies correctly listed.')
        console.log();
        console.log(chalk.cyan('Checked:'));
        console.log(
          workspaces
          .filter(workspace => !skipedWorkspaces.includes(workspace))
          .join('\n')
        );
        console.log();
        console.log(chalk.cyan('Skiped:'));
        console.log(skipedWorkspaces.join('\n'));
        console.log();
        console.log(chalk.green('Success!'));
    } else {
        errors.forEach(msg => console.error(msg));
    }
}

async function checkPackage({pkgRootDir, dependencyCheckOpts={excludeDev: true}, skip}) {
    const pkgPath = pathModule.resolve(pkgRootDir, './package.json');

    const jsFiles = (
        [
            ...findPackageFiles('*.js', {cwd: pkgRootDir, ignoreSubPackages: true}),
            ...findPackageFiles('*.jsx', {cwd: pkgRootDir, ignoreSubPackages: true}),
        ]
        .map(filePath => pathModule.relative(pkgRootDir, filePath))
    );
 // pkgRootDir.includes('plugins/init') && console.log(jsFiles);

    let data;
    try {
        data = await dependencyCheck({path: pkgPath, entries: jsFiles, excludeDev: true});
    } catch(err) {
        assert.log({jsFiles});
        console.error(chalk.bold.red('\nError checking jsFiles of '+pkgPath+'\n'));
        console.error(err);
        process.exit();
    }

    const pkg = data.package;
    const deps = data.used;

    const extras = (
        dependencyCheck.extra(pkg, deps, dependencyCheckOpts)
        .filter(pkgName => !skip.includes(pkgName))
        .filter(pkgName =>
            !jsFiles.some(jsFile => {
                const jsFileContent = fs.readFileSync(pathModule.resolve(pkgRootDir, jsFile), 'utf-8');
                return (
                    jsFileContent.includes('require.resolve("'+pkgName+'")') ||
                    jsFileContent.includes("require.resolve('"+pkgName+"')")
                );
            })
        )
    );

    const errors = [];

    if( extras.length ) {
        errors.push(chalk.red('Fail!')+' Modules in '+pkgPath+' '+chalk.bold.red('not used')+' in code: ' + extras.join(', '));
    }

    const missing = (
        dependencyCheck.missing(pkg, deps, dependencyCheckOpts)
        .filter(pkgName => !skip.includes(pkgName))
    );

    if( missing.length ) {
        errors.push(chalk.red('Fail!')+' Dependencies '+chalk.bold.red('not listed')+' in '+pkgPath+': ' + missing.join(', '));
    }

    return errors;
}

function isCli() { return require.main === module; }

async function getPackageJson(packageRootDir) {
    const packageJsonFile = pathModule.resolve(packageRootDir, './package.json');
    try {
        return require(packageJsonFile);
    } catch(err) {
        console.error(chalk.bold.red("Error parsing `"+packageJsonFile+"`:"));
        throw err;
    }
}
