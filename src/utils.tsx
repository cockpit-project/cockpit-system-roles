/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import React, { useState, useRef, useEffect } from 'react';

import { Button, ButtonProps } from '@patternfly/react-core/dist/esm/components/Button';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput';
import { RhUiExternalLinkIcon } from '@patternfly/react-icons';
import { Tbody, Tr, Td, ExpandableRowContent } from '@patternfly/react-table';

import { FileChooserInput, FileChooserProps } from 'cockpit/react/FileChooser';

export function JSON_parse_carefully(input: string, def?: unknown): unknown {
    try {
        return JSON.parse(input);
    } catch {
        return def;
    }
}

function same_typeof<T>(a: unknown, b: T): a is T {
    return typeof a === typeof b;
}

export function JSON_parse_type<T>(input: string, def: T): T {
    let v = JSON_parse_carefully(input);
    if (same_typeof(v, def))
        return v;
    else
        return def;
}

export const ExternalLinkButton = (props : ButtonProps) => (
    <Button
        component="a"
        icon={<RhUiExternalLinkIcon />}
        iconPosition="right"
        rel="noopener noreferrer"
        target="_blank"
        {...props}
    />
);

export const ExpandableTr = ({
    rowIndex,
    expandableContent,
    children,
} : {
    rowIndex: number,
    expandableContent: React.ReactNode,
    children: React.ReactNode[],
}) => {
    const [expanded, setExpanded] = useState<boolean>(false);

    return (
        <Tbody isExpanded={expanded}>
            <Tr>
                <Td
                    expand={
                        {
                            rowIndex,
                            isExpanded: expanded,
                            onToggle: () => {
                                setExpanded(!expanded);
                            }
                        }
                    }
                />
                { children }
            </Tr>
            <Tr isExpanded={expanded}>
                <Td colSpan={children.length + 1}>
                    <ExpandableRowContent>
                        { expandableContent }
                    </ExpandableRowContent>
                </Td>
            </Tr>
        </Tbody>
    );
};

export const DebouncedTextInput = ({
    value,
    onChange,
    placeholder,
} : {
    value: string,
    onChange: (val: string) => void,
    placeholder?: string,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const timer = useRef<number>(0);

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <TextInput
            value={localValue}
            onChange={
                (_event, val) => {
                    setLocalValue(val);
                    if (timer.current)
                        window.clearTimeout(timer.current);
                    timer.current = window.setTimeout(
                        () => {
                            timer.current = 0;
                            onChange(val);
                        },
                        500);
                }
            }
            {...placeholder ? { placeholder } : {}}
        />
    );
};

export const DebouncedFileChooserInput = ({
    value,
    onChange,
    fileChooserProps,
} : {
    value: string,
    onChange: (val: string) => void,
    fileChooserProps: FileChooserProps,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const timer = useRef<number>(0);

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <FileChooserInput
            value={localValue}
            onChange={
                (val, fromDialog) => {
                    setLocalValue(val);
                    if (timer.current)
                        window.clearTimeout(timer.current);
                    if (!fromDialog) {
                        timer.current = window.setTimeout(
                            () => {
                                timer.current = 0;
                                onChange(val);
                            },
                            500);
                    } else
                        onChange(val);
                }
            }
            fileChooserProps={fileChooserProps}
        />
    );
};
